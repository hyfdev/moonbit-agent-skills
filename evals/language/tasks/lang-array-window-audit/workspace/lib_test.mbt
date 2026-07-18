///|
test "replacement mutates the selected window" {
  let values = [1, 2, 2, 4]
  let original_sum = replace_and_audit(values, 1, 3, 2)
  assert_eq(original_sum, 4)
  assert_eq(values, [1, 2, 2, 4])
}

///|
test "empty window changes nothing" {
  let values = [1, 2]
  assert_eq(replace_and_audit(values, 1, 1, 9), 0)
  assert_eq(values, [1, 2])
}
