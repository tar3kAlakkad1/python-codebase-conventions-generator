/*
  Ad-hoc dev test for parsePythonFiles. Run with:
    npm run devtest:parser
*/

import { parsePythonFiles } from "./python-parser";

async function main() {
  const content = `
"""module doc"""
import os, sys as system
from typing import List, Optional as Opt

TOP = 123

@decorator
class Foo(Base1, Base2):
    """Foo docs"""

    @staticmethod
    def bar(x: int, y: int) -> int:
        """adds"""
        return add(x, y)

    async def baz(self, items: List[str]):
        for it in items:
            self.bar(len(it), 2)

def add(a, b):
    return a + b

async def coro(x):
    await something(x)
`;

  const files = [
    {
      name: "sample.py",
      content,
    },
  ];

  const result = await parsePythonFiles(files, { includeDocstrings: true });
  console.log(JSON.stringify(result, null, 2));

  const mod = result[0];
  assert(mod.functions.length >= 2, "should parse top-level functions");
  assert(mod.classes.length === 1, "should parse one class");
  assert(mod.imports.length === 2, "should parse imports");
  assert(mod.variables.length === 1 && mod.variables[0].name === "TOP", "should parse top-level variable");

  const foo = mod.classes[0];
  assert(foo.methods.length === 2, "class should have two methods");
  const bar = foo.methods.find((m) => m.name === "bar");
  assert(bar && bar.calls.some((c) => c.name === "add"), "bar should call add");

  const coro = mod.functions.find((f) => f.name === "coro");
  assert(coro && coro.isAsync, "coro should be async");

  console.log("All dev assertions passed.");
}

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) {
    throw new Error("Assertion failed: " + message);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});


