fn release_soft_keyword_identifier() -> Int {
  let extend = 42
  extend
}

test "extend as an identifier" {
  assert_eq(release_soft_keyword_identifier(), 42)
}
