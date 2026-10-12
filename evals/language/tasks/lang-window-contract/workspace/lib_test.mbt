///|
test "ordinary record and preview windows" {
  assert_eq(@window_contract.record_window([10, 20, 30], 1, 3), [20, 30])
  assert_eq(@window_contract.preview_window([10, 20, 30], 1, 3), [20, 30])
}
