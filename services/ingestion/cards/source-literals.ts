import ts from "typescript";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
/** Read data-only TypeScript literals. Never evaluate downloaded source code. */
export function sourceLiterals(root: string) {
  const cache = new Map<string, unknown>();
  function read(file: string): unknown {
    file = resolve(file);
    if (relative(root, file).startsWith(".."))
      throw new Error("SOURCE_PATH_ESCAPE");
    if (cache.has(file)) return cache.get(file);
    const source = ts.createSourceFile(
      file,
      readFileSync(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const values = new Map<string, ts.Expression>(),
      imports = new Map<string, string>();
    let exported: ts.Expression | undefined;
    for (const item of source.statements) {
      if (
        ts.isImportDeclaration(item) &&
        ts.isStringLiteral(item.moduleSpecifier) &&
        item.importClause?.name
      ) {
        const path = resolve(
          dirname(file),
          item.moduleSpecifier.text.replace(/\.ts$/, "") + ".ts",
        );
        if (existsSync(path)) imports.set(item.importClause.name.text, path);
      }
      if (ts.isVariableStatement(item))
        for (const d of item.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer)
            values.set(d.name.text, d.initializer);
        }
      if (ts.isExportAssignment(item)) exported = item.expression;
    }
    function literal(node: ts.Expression): unknown {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
        return node.text;
      if (ts.isNumericLiteral(node)) return Number(node.text);
      if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
      if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
      if (node.kind === ts.SyntaxKind.NullKeyword) return null;
      if (
        ts.isAsExpression(node) ||
        ts.isParenthesizedExpression(node) ||
        ts.isSatisfiesExpression(node)
      )
        return literal(node.expression);
      if (
        ts.isPrefixUnaryExpression(node) &&
        node.operator === ts.SyntaxKind.MinusToken
      )
        return -Number(literal(node.operand));
      if (
        ts.isBinaryExpression(node) &&
        node.operatorToken.kind === ts.SyntaxKind.PlusToken
      ) {
        const left = literal(node.left),
          right = literal(node.right);
        if (typeof left === "string" && typeof right === "string")
          return left + right;
        if (typeof left === "number" && typeof right === "number")
          return left + right;
        throw new Error("INVALID_LITERAL_ADDITION");
      }
      if (ts.isArrayLiteralExpression(node))
        return node.elements.map((e) => literal(e as ts.Expression));
      if (ts.isIdentifier(node)) {
        if (node.text === "undefined") return undefined;
        if (imports.has(node.text)) return read(imports.get(node.text)!);
        if (values.has(node.text)) return literal(values.get(node.text)!);
      }
      if (ts.isObjectLiteralExpression(node)) {
        const result: Record<string, unknown> = Object.create(null);
        for (const p of node.properties) {
          if (ts.isSpreadAssignment(p)) {
            Object.assign(result, literal(p.expression));
            continue;
          }
          if (
            !ts.isPropertyAssignment(p) ||
            !p.name ||
            ts.isComputedPropertyName(p.name)
          )
            throw new Error("NON_LITERAL_PROPERTY");
          const key =
            ts.isIdentifier(p.name) ||
            ts.isStringLiteral(p.name) ||
            ts.isNumericLiteral(p.name)
              ? p.name.text
              : null;
          if (!key || ["__proto__", "constructor", "prototype"].includes(key))
            throw new Error("INVALID_SOURCE_KEY");
          result[key] = literal(p.initializer);
        }
        return result;
      }
      throw new Error(`NON_LITERAL_SOURCE:${ts.SyntaxKind[node.kind]}`);
    }
    if (!exported) throw new Error("NO_DEFAULT_SOURCE");
    const result = literal(exported);
    cache.set(file, result);
    return result;
  }
  return read;
}
