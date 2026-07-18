///|
test "accepts identifiers" {
  assert_true(is_identifier("name"))
  assert_true(is_identifier("_x2"))
}
