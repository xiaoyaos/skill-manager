function parseScalar(rawValue) {
  const value = String(rawValue).trim();
  if (!value) {
    return "";
  }
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value.slice(1, -1);
    }
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replaceAll("''", "'");
  }
  return value;
}

function parseNested(lines) {
  const result = {};
  for (const line of lines) {
    const match = line.match(/^\s+([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (match) {
      result[match[1]] = parseScalar(match[2]);
    }
  }
  return result;
}

function parseFrontmatter(text) {
  const normalized = String(text).replace(/^\uFEFF/, "");
  const lines = normalized.split(/\r?\n/);
  if (lines[0].trim() !== "---") {
    return {};
  }

  let end = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if (lines[index].trim() === "---") {
      end = index;
      break;
    }
  }
  if (end === -1) {
    return {};
  }

  const body = lines.slice(1, end);
  const result = {};
  let index = 0;

  while (index < body.length) {
    const line = body[index];
    if (!line.trim() || line.trim().startsWith("#")) {
      index += 1;
      continue;
    }
    if (/^\s+/.test(line)) {
      index += 1;
      continue;
    }

    const match = line.match(/^([A-Za-z0-9_.-]+):\s*(.*)$/);
    if (!match) {
      index += 1;
      continue;
    }

    const key = match[1];
    const rest = match[2].trim();

    if (rest === "") {
      const block = [];
      index += 1;
      while (
        index < body.length &&
        (body[index].trim() === "" || /^\s+/.test(body[index]))
      ) {
        block.push(body[index]);
        index += 1;
      }
      const nonEmpty = block.filter((item) => item.trim());
      if (
        nonEmpty.length > 0 &&
        nonEmpty.every((item) => /^\s+[A-Za-z0-9_.-]+:/.test(item))
      ) {
        result[key] = parseNested(block);
      } else {
        result[key] = nonEmpty.map((item) => item.trim()).join(" ");
      }
      continue;
    }

    if (/^[|>][+-]?$/.test(rest)) {
      const block = [];
      index += 1;
      while (
        index < body.length &&
        (body[index].trim() === "" || /^\s+/.test(body[index]))
      ) {
        block.push(body[index].replace(/^\s{2}/, ""));
        index += 1;
      }
      result[key] = rest.startsWith(">")
        ? block.join(" ").trim()
        : block.join("\n").trim();
      continue;
    }

    result[key] = parseScalar(rest);
    index += 1;
  }

  return result;
}

module.exports = { parseFrontmatter };
