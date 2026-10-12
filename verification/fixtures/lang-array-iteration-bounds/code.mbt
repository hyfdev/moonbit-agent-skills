test "appends do not extend an existing iterator" {
  let values = [1, 2, 3]
  let iterator = values.iter()
  values.push(4)
  assert_eq(iterator.collect(), [1, 2, 3])
}
