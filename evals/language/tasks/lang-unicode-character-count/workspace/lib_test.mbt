///|
test "ASCII text at the limit" {
  assert_true(@unicode_character_count.within_character_limit("Ada", 3))
}

///|
test "ASCII text under the limit" {
  assert_true(@unicode_character_count.within_character_limit("Ada", 4))
}

///|
test "ASCII text over the limit" {
  assert_false(@unicode_character_count.within_character_limit("Ada", 2))
}

///|
test "BMP text" {
  assert_true(@unicode_character_count.within_character_limit("月", 1))
}
