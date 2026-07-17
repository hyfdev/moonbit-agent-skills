export interface Frontmatter {
  [key: string]: string | Record<string, string>;
}

export interface ParsedFrontmatter {
  frontmatter: Frontmatter;
  body: string;
  errors: string[];
}

/** Parse the deliberately small YAML subset supported by this repository. */
export function parseFrontmatter(text: string): ParsedFrontmatter {
  const errors: string[] = [];
  if (!text.startsWith("---\n")) {
    return {
      frontmatter: {},
      body: text,
      errors: ["missing frontmatter opening '---'"],
    };
  }

  const end = text.indexOf("\n---\n", 4);
  if (end === -1) {
    return {
      frontmatter: {},
      body: text,
      errors: ["missing frontmatter closing '---'"],
    };
  }

  const raw = text.slice(4, end);
  const body = text.slice(end + 5);
  const data: Frontmatter = {};
  let currentMap: Record<string, string> | undefined;

  for (const [index, line] of raw.split("\n").entries()) {
    const lineNumber = index + 2;
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      continue;
    }

    if (line.startsWith("  ") && currentMap !== undefined) {
      const match = /^  ([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
      if (match === null) {
        errors.push(`line ${lineNumber}: unparseable nested entry ${JSON.stringify(line)}`);
        continue;
      }
      currentMap[match[1]] = stripScalar(match[2].trim());
      continue;
    }

    const match = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (match === null) {
      errors.push(`line ${lineNumber}: unparseable entry ${JSON.stringify(line)}`);
      continue;
    }
    const key = match[1];
    const value = match[2].trim();
    if (value === "") {
      currentMap = {};
      data[key] = currentMap;
    } else {
      data[key] = stripScalar(value);
      currentMap = undefined;
    }
  }

  return { frontmatter: data, body, errors };
}

function stripScalar(value: string): string {
  return value.replace(/^["']+|["']+$/g, "");
}

export function scalar(frontmatter: Frontmatter, key: string): string | undefined {
  const value = frontmatter[key];
  return typeof value === "string" ? value : undefined;
}

export function stringMap(
  frontmatter: Frontmatter,
  key: string,
): Record<string, string> | undefined {
  const value = frontmatter[key];
  return typeof value === "object" ? value : undefined;
}
