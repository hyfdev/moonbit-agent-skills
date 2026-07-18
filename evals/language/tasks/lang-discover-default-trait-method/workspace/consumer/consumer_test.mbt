test "qualified default method remains available" {
  assert_eq(@api.describe_qualified(@api.Item("chair")), "item chair")
}
