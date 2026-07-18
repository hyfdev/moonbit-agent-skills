test "ancestor package can import its internal descendant" {
  assert_eq(@secret.answer(), 42)
}
