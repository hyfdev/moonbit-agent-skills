test "qualified trait method remains available" {
  assert_eq(@api.greet_qualified(@api.Robot("R2")), "hello R2")
}
