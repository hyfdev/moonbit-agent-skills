///|
test "ts ${} is literal text, not interpolation" {
  let name = "World"
  ignore(name)
  // A TypeScript programmer expects "Hello World"; MoonBit keeps ${name} verbatim:
  inspect("Hello ${name}", content="Hello ${name}")
}
