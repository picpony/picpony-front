/** Runtime import graph for architecture checks. Type references never become runtime edges. */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import ts from 'typescript';

const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];
const isSource = (file) => EXTENSIONS.some((ext) => file.endsWith(ext)) && !/\.d\.[cm]?ts$/.test(file);

export function readSources(root) {
  const sources = new Map();
  for (const directory of ['app', 'components', 'lib']) {
    for (const name of readdirSync(path.join(root, directory), { recursive: true }).sort()) {
      const file = `${directory}/${name.replaceAll('\\', '/')}`;
      if (isSource(file)) sources.set(file, readFileSync(path.join(root, file), 'utf8'));
    }
  }
  return sources;
}

function typeOnly(node) {
  if (node.isTypeOnly || node.importClause?.isTypeOnly) return true;
  const bindings = node.importClause?.namedBindings ?? node.exportClause;
  return !node.importClause?.name && bindings &&
    (ts.isNamedImports(bindings) || ts.isNamedExports(bindings)) &&
    bindings.elements.length > 0 && bindings.elements.every((item) => item.isTypeOnly);
}

export function buildGraph(sources) {
  const graph = new Map();
  for (const [file, source] of sources) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    const edges = [];
    const add = (literal, dynamic = false) => {
      if (!literal || !ts.isStringLiteralLike(literal)) return;
      const specifier = literal.text;
      const local = specifier.startsWith('@/') ? specifier.slice(2) :
        specifier.startsWith('.') ? path.posix.join(path.posix.dirname(file), specifier) : null;
      // TypeScript resolves an explicit JS extension to its source TS file too.
      const stem = local?.replace(/\.[cm]?jsx?$/, '');
      const candidates = local === null ? [] : [local, ...EXTENSIONS.map((ext) => stem + ext),
        ...EXTENSIONS.map((ext) => `${local}/index${ext}`)];
      const target = candidates.find((candidate) => sources.has(candidate)) ?? local ?? specifier;
      edges.push({ target, specifier, dynamic, line: ast.getLineAndCharacterOfPosition(literal.getStart(ast)).line + 1 });
    };
    const visit = (node) => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (!typeOnly(node)) add(node.moduleSpecifier);
        return;
      }
      if (ts.isImportEqualsDeclaration(node)) {
        if (!node.isTypeOnly && ts.isExternalModuleReference(node.moduleReference)) add(node.moduleReference.expression);
        return;
      }
      if (ts.isCallExpression(node)) {
        if (node.expression.kind === ts.SyntaxKind.ImportKeyword) add(node.arguments[0], true);
        else if (ts.isIdentifier(node.expression) && node.expression.text === 'require') add(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    graph.set(file, {
      client: ast.statements.some((node) => ts.isExpressionStatement(node) &&
        ts.isStringLiteral(node.expression) && node.expression.text === 'use client'),
      edges,
    });
  }
  return graph;
}

/** A shortest dependency path, including the importing file and the offending target. */
export function findPath(graph, start, matches, includeDynamic = false) {
  const queue = [[start]];
  const seen = new Set([start]);
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const chain = queue[cursor];
    const file = chain.at(-1);
    if (matches(file)) return chain;
    for (const edge of graph.get(file)?.edges ?? []) {
      if ((!includeDynamic && edge.dynamic) || seen.has(edge.target)) continue;
      seen.add(edge.target);
      queue.push([...chain, edge.target]);
    }
  }
  return null;
}

/** Static cycles only: a deferred engine may bind back to its lightweight runtime. */
export function findCycles(graph) {
  const done = new Set();
  const active = new Map();
  const stack = [];
  const cycles = [];
  const visit = (file) => {
    if (active.has(file)) {
      cycles.push([...stack.slice(active.get(file)), file]);
      return;
    }
    if (done.has(file)) return;
    active.set(file, stack.length);
    stack.push(file);
    for (const edge of graph.get(file)?.edges ?? []) if (!edge.dynamic && graph.has(edge.target)) visit(edge.target);
    stack.pop();
    active.delete(file);
    done.add(file);
  };
  for (const file of graph.keys()) visit(file);
  return cycles;
}
