import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import type { DynamicTranslationCall } from "./dynamicKeys";
import { flattenResource, type JsonValue } from "./localeValidation";
import { isAllowedEnglishText } from "./englishAllowlist";

const VISIBLE_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "placeholder",
  "title",
]);

const STATIC_MESSAGE_CALLEES = new Set([
  "showError",
  "showInfo",
  "showSuccess",
  "showWarning",
  "toast",
  "setError",
]);

const TOAST_MESSAGE_CALLEES = new Set([
  "toast.success",
  "toast.error",
  "toast.info",
  "toast.warning",
]);

export interface SourceAuditFinding {
  filePath: string;
  line: number;
  category: string;
  text: string;
}

export interface TranslationCall {
  filePath: string;
  line: number;
  namespace: string;
  keys: string[];
  signature: string;
  dynamic: boolean;
}

export interface AuditedSourceFile {
  filePath: string;
  findings: SourceAuditFinding[];
  translationCalls: TranslationCall[];
}

export interface TranslationResources {
  en: Record<string, JsonValue>;
  zhCN: Record<string, JsonValue>;
}

interface TranslatorBinding {
  namespace: string;
  keyPrefix?: string;
}

export function rendererFiles(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return rendererFiles(entryPath);
    if (!/\.(ts|tsx)$/.test(entry.name)) return [];
    if (/(\.test|\.spec)\.(ts|tsx)$/.test(entry.name)) return [];
    return [entryPath];
  });
}

function textFromNode(node: any): string | null {
  if (!node) return null;
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "JSXExpressionContainer") {
    return textFromNode(node.expression);
  }
  if (node.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis[0]?.value?.cooked ?? "";
  }
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "ParenthesizedExpression"
  ) {
    return textFromNode(node.expression);
  }
  return null;
}

function staticTextFragments(node: any): string[] {
  if (!node) return [];
  if (node.type === "StringLiteral") return [node.value];
  if (node.type === "TemplateLiteral") {
    return node.quasis
      .map((quasi: any) => quasi.value?.cooked ?? "")
      .filter(Boolean);
  }
  if (node.type === "JSXExpressionContainer") {
    return staticTextFragments(node.expression);
  }
  if (node.type === "ConditionalExpression") {
    return [
      ...staticTextFragments(node.consequent),
      ...staticTextFragments(node.alternate),
    ];
  }
  if (node.type === "LogicalExpression") {
    return staticTextFragments(node.right);
  }
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return [
      ...staticTextFragments(node.left),
      ...staticTextFragments(node.right),
    ];
  }
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "ParenthesizedExpression"
  ) {
    return staticTextFragments(node.expression);
  }
  if (node.type === "ObjectExpression") {
    return node.properties.flatMap((property: any) =>
      staticTextFragments(property.value),
    );
  }
  // Do not inspect calls here: t("key") and similar expressions contain
  // translation keys, not user-visible fallback copy.
  return [];
}

function transChildTextFragments(children: any[]): string[] {
  return children.flatMap((child) => {
    if (child?.type === "JSXText") return [child.value];
    if (child?.type === "JSXExpressionContainer") {
      return staticTextFragments(child.expression);
    }
    if (child?.type === "JSXElement") {
      return transChildTextFragments(child.children ?? []);
    }
    return [];
  });
}

function staticKeysFromNode(node: any): string[] {
  if (!node) return [];
  const text = textFromNode(node);
  if (text !== null) return [text];
  if (node.type === "ConditionalExpression") {
    return [
      ...staticKeysFromNode(node.consequent),
      ...staticKeysFromNode(node.alternate),
    ];
  }
  if (
    node.type === "TSAsExpression" ||
    node.type === "TSTypeAssertion" ||
    node.type === "ParenthesizedExpression"
  ) {
    return staticKeysFromNode(node.expression);
  }
  return [];
}

function defaultNamespace(source: string): string {
  const match = source.match(/useTranslation\(\s*(?:\[\s*)?["']([^"']+)["']*/);
  return match?.[1] ?? "common";
}

function namespaceAndKey(rawKey: string, namespace: string) {
  const separator = rawKey.indexOf(":");
  return separator === -1
    ? { namespace, key: rawKey }
    : {
        namespace: rawKey.slice(0, separator),
        key: rawKey.slice(separator + 1),
      };
}

function calleeName(node: any): string | null {
  if (!node) return null;
  if (node.type === "Identifier") return node.name;
  if (node.type === "MemberExpression" && !node.computed) {
    const object = calleeName(node.object);
    const property = calleeName(node.property);
    return object && property ? `${object}.${property}` : property;
  }
  return null;
}

function isFixedTranslationFactory(node: any): boolean {
  const name = calleeName(node);
  return name === "getFixedT" || name?.endsWith(".getFixedT") === true;
}

function fixedTranslationNamespace(node: any, fallback: string): string {
  if (!isFixedTranslationFactory(node)) return fallback;

  // i18next accepts getFixedT(lng, ns, keyPrefix), while wrappers in the
  // renderer commonly pass only a namespace. Pick the first string that names
  // one of the app's namespaces and otherwise retain the file namespace.
  const candidates = node.arguments ?? [];
  for (const candidate of candidates) {
    const value = textFromNode(candidate);
    if (
      value &&
      ["common", "settings", "chat", "home", "errors"].includes(value)
    ) {
      return value;
    }
  }
  return fallback;
}

function fixedTranslationKeyPrefix(node: any): string | undefined {
  if (!isFixedTranslationFactory(node)) return undefined;
  return textFromNode(node.arguments?.[2]) ?? undefined;
}

function resolveTranslationKey(
  rawKey: string,
  namespace: string,
  keyPrefix?: string,
) {
  const resolved = namespaceAndKey(rawKey, namespace);
  return {
    namespace: resolved.namespace,
    key:
      keyPrefix && !rawKey.includes(":")
        ? `${keyPrefix}.${resolved.key}`
        : resolved.key,
  };
}

function addTextFinding(
  findings: SourceAuditFinding[],
  filePath: string,
  line: number,
  category: string,
  text: string,
) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || !/[A-Za-z]{2,}/.test(normalized)) return;
  if (isAllowedEnglishText(normalized)) return;
  findings.push({ filePath, line, category, text: normalized });
}

export function auditSourceText(
  source: string,
  filePath: string,
): { findings: SourceAuditFinding[]; translationCalls: TranslationCall[] } {
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx", "decorators-legacy"],
  });
  const namespace = defaultNamespace(source);
  const findings: SourceAuditFinding[] = [];
  const translationCalls: TranslationCall[] = [];
  const translatorBindings = new Map<string, TranslatorBinding>();

  const visit = (
    node: any,
    insideTrans = false,
    insideAttribute = false,
    insideStyle = false,
  ) => {
    if (!node || typeof node !== "object") return;

    const nodeLine = node.loc?.start.line ?? ast.loc?.start.line ?? 1;
    let childInsideTrans = insideTrans;
    const isStyleElement =
      node.type === "JSXElement" &&
      node.openingElement?.name?.name?.toLowerCase?.() === "style";
    const childInsideStyle = insideStyle || isStyleElement;

    if (
      node.type === "VariableDeclarator" &&
      node.init?.type === "CallExpression"
    ) {
      const initializerName = calleeName(node.init.callee);
      if (initializerName === "useTranslation") {
        const bindingNamespace =
          textFromNode(node.init.arguments?.[0]) ?? namespace;
        if (node.id?.type === "ObjectPattern") {
          for (const property of node.id.properties ?? []) {
            const propertyName = property.key?.name ?? property.key?.value;
            const localName = property.value?.name;
            if (propertyName === "t" && localName) {
              translatorBindings.set(localName, {
                namespace: bindingNamespace,
              });
            }
          }
        }
      } else if (
        node.id?.type === "Identifier" &&
        isFixedTranslationFactory(node.init.callee)
      ) {
        translatorBindings.set(node.id.name, {
          namespace: fixedTranslationNamespace(node.init.callee, namespace),
          keyPrefix: fixedTranslationKeyPrefix(node.init.callee),
        });
      }
    }

    if (node.type === "JSXElement") {
      const name = node.openingElement?.name?.name;
      if (name === "Trans") {
        childInsideTrans = true;
        const i18nKey = node.openingElement.attributes?.find(
          (attribute: any) => attribute.name?.name === "i18nKey",
        );
        const defaultValue = node.openingElement.attributes?.find(
          (attribute: any) =>
            attribute.name?.name === "defaults" ||
            attribute.name?.name === "defaultValue",
        );
        const keyText = textFromNode(i18nKey?.value);
        const defaultText = textFromNode(defaultValue?.value);
        if (keyText) {
          const resolved = namespaceAndKey(keyText, namespace);
          translationCalls.push({
            filePath,
            line: nodeLine,
            namespace: resolved.namespace,
            keys: [resolved.key],
            signature: `Trans:${keyText}`,
            dynamic: false,
          });
        } else {
          translationCalls.push({
            filePath,
            line: nodeLine,
            namespace,
            keys: [],
            signature: "Trans:dynamic",
            dynamic: true,
          });
        }
        if (defaultText) {
          addTextFinding(
            findings,
            filePath,
            nodeLine,
            "Trans defaultValue",
            defaultText,
          );
        } else {
          for (const childText of transChildTextFragments(
            node.children ?? [],
          )) {
            addTextFinding(
              findings,
              filePath,
              nodeLine,
              "Trans defaultValue",
              childText,
            );
          }
        }
      }
    }

    if (!insideStyle && !insideTrans && node.type === "JSXText") {
      addTextFinding(findings, filePath, nodeLine, "JSX text", node.value);
    }

    if (!insideStyle && node.type === "JSXAttribute") {
      const attributeName = node.name?.name;
      if (VISIBLE_ATTRIBUTES.has(attributeName)) {
        for (const attributeText of staticTextFragments(node.value)) {
          addTextFinding(
            findings,
            filePath,
            nodeLine,
            attributeName,
            attributeText,
          );
        }
      }
    }

    if (
      !insideStyle &&
      node.type === "JSXExpressionContainer" &&
      !insideAttribute
    ) {
      for (const expressionText of staticTextFragments(node.expression)) {
        addTextFinding(
          findings,
          filePath,
          nodeLine,
          "JSX expression",
          expressionText,
        );
      }
    }

    if (node.type === "CallExpression") {
      const name = calleeName(node.callee);
      const aliasBinding = name ? translatorBindings.get(name) : undefined;
      const isFixedCall =
        node.callee?.type === "CallExpression" &&
        isFixedTranslationFactory(node.callee.callee);
      const isTranslationCall =
        name === "t" ||
        name === "i18n.t" ||
        aliasBinding !== undefined ||
        isFixedCall;
      if (isTranslationCall) {
        const keys = staticKeysFromNode(node.arguments[0]);
        const signature = source
          .slice(node.start, node.end)
          .replace(/\s+/g, " ")
          .trim();
        const callNamespace =
          aliasBinding?.namespace ??
          (isFixedCall
            ? fixedTranslationNamespace(node.callee, namespace)
            : namespace);
        const keyPrefix =
          aliasBinding?.keyPrefix ??
          (isFixedCall ? fixedTranslationKeyPrefix(node.callee) : undefined);
        const resolvedKeys = keys.map((key) =>
          resolveTranslationKey(key, callNamespace, keyPrefix),
        );
        const resolved = resolvedKeys[0] ?? {
          namespace: callNamespace,
          key: "",
        };
        translationCalls.push({
          filePath,
          line: nodeLine,
          namespace: resolved.namespace,
          keys: resolvedKeys.map(({ key }) => key),
          signature,
          dynamic: keys.length === 0,
        });
      }

      if (
        name &&
        (STATIC_MESSAGE_CALLEES.has(name) || TOAST_MESSAGE_CALLEES.has(name))
      ) {
        for (const messageText of staticTextFragments(node.arguments[0])) {
          addTextFinding(
            findings,
            filePath,
            nodeLine,
            "static message",
            messageText,
          );
        }
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "loc" || key === "start" || key === "end") continue;
      const childInsideAttribute =
        insideAttribute || node.type === "JSXAttribute";
      if (Array.isArray(value)) {
        value.forEach((child) =>
          visit(
            child,
            childInsideTrans,
            childInsideAttribute,
            childInsideStyle,
          ),
        );
      } else if (value && typeof value === "object") {
        visit(value, childInsideTrans, childInsideAttribute, childInsideStyle);
      }
    }
  };

  visit(ast);
  return { findings, translationCalls };
}

export function auditSourceFile(filePath: string): {
  findings: SourceAuditFinding[];
  translationCalls: TranslationCall[];
} {
  return auditSourceText(fs.readFileSync(filePath, "utf8"), filePath);
}

export function auditRenderer(roots: string[]) {
  return roots.flatMap((root) =>
    rendererFiles(root).map((filePath) => ({
      filePath,
      ...auditSourceFile(filePath),
    })),
  );
}

function resourceKeys(
  resources: Record<string, JsonValue>,
  namespace: string,
): Set<string> {
  const resource = resources[namespace];
  const keys = new Set(resource ? Object.keys(flattenResource(resource)) : []);
  for (const key of keys) {
    if (key.endsWith("_one") && keys.has(`${key.slice(0, -4)}_other`)) {
      keys.add(key.slice(0, -4));
    }
  }
  return keys;
}

function splitQualifiedKey(rawKey: string, fallbackNamespace: string) {
  const resolved = namespaceAndKey(rawKey, fallbackNamespace);
  return { namespace: resolved.namespace, key: resolved.key };
}

export function findTranslationKeyIssues(
  auditedFiles: AuditedSourceFile[],
  resources: TranslationResources,
  dynamicRegistry: DynamicTranslationCall[],
): string[] {
  const issues: string[] = [];
  const enKeys = new Map<string, Set<string>>();
  const zhCNKeys = new Map<string, Set<string>>();

  for (const namespace of ["common", "settings", "chat", "home", "errors"]) {
    enKeys.set(namespace, resourceKeys(resources.en, namespace));
    zhCNKeys.set(namespace, resourceKeys(resources.zhCN, namespace));
  }

  const registrySignatures = new Set(
    dynamicRegistry.map((entry) => `${entry.filePath}\u0000${entry.signature}`),
  );
  const observedRegistrySignatures = new Set<string>();

  for (const file of auditedFiles) {
    for (const call of file.translationCalls) {
      if (call.dynamic) {
        const signature = `${call.filePath}\u0000${call.signature}`;
        if (!registrySignatures.has(signature)) {
          issues.push(
            `${call.filePath}:${call.line} dynamic translation call is not registered: ${call.signature}`,
          );
        } else {
          observedRegistrySignatures.add(signature);
        }
        continue;
      }

      for (const rawKey of call.keys) {
        const resolved = splitQualifiedKey(rawKey, call.namespace);
        if (!enKeys.get(resolved.namespace)?.has(resolved.key)) {
          issues.push(
            `${call.filePath}:${call.line} ${resolved.namespace}:${resolved.key} missing from en`,
          );
        }
        if (!zhCNKeys.get(resolved.namespace)?.has(resolved.key)) {
          issues.push(
            `${call.filePath}:${call.line} ${resolved.namespace}:${resolved.key} missing from zh-CN`,
          );
        }
      }
    }
  }

  for (const entry of dynamicRegistry) {
    const signature = `${entry.filePath}\u0000${entry.signature}`;
    if (!observedRegistrySignatures.has(signature)) {
      issues.push(
        `${entry.filePath} dynamic translation registry entry was not found: ${entry.signature}`,
      );
    }

    for (const rawKey of entry.keys) {
      if (!rawKey.includes(":")) {
        issues.push(
          `${entry.filePath} dynamic key must include a namespace: ${rawKey}`,
        );
      }
      const resolved = splitQualifiedKey(rawKey, "common");
      if (!enKeys.get(resolved.namespace)?.has(resolved.key)) {
        issues.push(
          `${entry.filePath} dynamic key ${resolved.namespace}:${resolved.key} missing from en`,
        );
      }
      if (!zhCNKeys.get(resolved.namespace)?.has(resolved.key)) {
        issues.push(
          `${entry.filePath} dynamic key ${resolved.namespace}:${resolved.key} missing from zh-CN`,
        );
      }
    }
  }

  return issues;
}
