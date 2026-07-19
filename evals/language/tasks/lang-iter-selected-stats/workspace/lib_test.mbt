///|
test "no values selected" {
  assert_eq(selected_stats([1, 2, 3].iter(), 9), (0, 0))
}
