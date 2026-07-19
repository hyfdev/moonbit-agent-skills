///|
test "default consumer keeps the fallback" {
  assert_eq(@virtual.provider_name(), "default")
}
