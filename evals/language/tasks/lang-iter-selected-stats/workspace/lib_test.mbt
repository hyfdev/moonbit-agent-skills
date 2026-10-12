///|
test "no values selected" {
  assert_eq(@iter_selected_stats.selected_stats([1, 2, 3].iter(), 9), (0, 0))
}
