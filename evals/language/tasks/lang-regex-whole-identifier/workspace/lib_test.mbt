///|
test "accepts identifiers" {
  assert_true(@regex_whole_identifier.is_identifier("name"))
  assert_true(@regex_whole_identifier.is_identifier("_x2"))
}
