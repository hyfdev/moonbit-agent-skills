///|
test "valid port" {
  assert_eq(@ports.parse_port("8080"), Some(8080))
}

///|
test "invalid port" {
  assert_eq(@ports.parse_port("80x0"), None)
}
