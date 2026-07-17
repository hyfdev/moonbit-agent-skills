///|
test "s[i] is a UInt16 code unit" {
  // TS: "abc"[0] == "a". Rust: indexing a String does not compile.
  // MoonBit: "abc"[0] is the number 97:
  inspect("abc"[0], content="97")
}
