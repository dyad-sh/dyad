/** Keep model-authored Dyad action markup distinct from host-emitted tool cards. */
export function claudeTextFilter(allowSecurityFindings = false) {
  let pending = "";
  return (text: string, final = false) => {
    pending += text;
    const lastTag = pending.lastIndexOf("<");
    const boundary =
      !final && lastTag >= 0 && /^<\/?[\w-]*$/.test(pending.slice(lastTag))
        ? lastTag
        : pending.length;
    const ready = pending.slice(0, boundary);
    pending = pending.slice(boundary);
    return ready.replace(/<\/?dyad-[\w-]+/gi, (tag) =>
      allowSecurityFindings && /^<\/?dyad-security-finding$/i.test(tag)
        ? tag
        : tag.replace("<", "&lt;"),
    );
  };
}
