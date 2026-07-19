///|
test "consumer resolves a provider" {
  assert_true(@virtual.provider_name() != "")
}
