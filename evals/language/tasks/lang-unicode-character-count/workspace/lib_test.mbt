///|
test "ASCII text at the limit" {
  assert_true(within_character_limit("Ada", 3))
}

///|
test "ASCII text under the limit" {
  assert_true(within_character_limit("Ada", 4))
}

///|
test "ASCII text over the limit" {
  assert_false(within_character_limit("Ada", 2))
}

///|
test "BMP text" {
  assert_true(within_character_limit("月", 1))
}
