import "i18next";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "common";
    // The renderer uses both fixed namespaces and explicit `namespace:key`
    // lookups. Runtime/source audits provide the resource parity checks for
    // those dynamic keys, while this keeps both call forms type-compatible.
    resources: object;
  }
}
