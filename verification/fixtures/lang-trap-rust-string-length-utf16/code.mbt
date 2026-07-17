///|
test "length() is UTF-16 code units" {
  // Rust: "\u{10348}".len() == 4 (UTF-8 bytes); it is 1 character.
  // MoonBit length() == 2 because U+10348 is a surrogate pair in UTF-16:
  inspect("\u{10348}".length(), content="2")
  inspect("\u{10348}".char_length(), content="1")
}
