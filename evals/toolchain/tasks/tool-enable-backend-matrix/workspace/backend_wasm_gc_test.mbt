///|
test "wasm-gc implementation is selected" {
  assert_eq(@backend_matrix.backend_name(), "wasm-gc")
}
