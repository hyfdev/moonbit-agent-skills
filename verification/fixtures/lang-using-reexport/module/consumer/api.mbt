test "pub using re-exports a function" {
  assert_eq(@bridge.increment(41), 42)
}
