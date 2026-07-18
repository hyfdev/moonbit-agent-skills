test "virtual package uses selected implementation" {
  assert_eq(@virtual.selected_value(), 2)
}
