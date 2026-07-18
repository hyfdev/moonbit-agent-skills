///|
test "decodes ping packets" {
  assert_eq(decode_tag(b"\x01hello"), "ping")
}

///|
test "decodes pong packets" {
  assert_eq(decode_tag(b"\x02world"), "pong")
}

///|
test "ignores payload after a valid tag" {
  assert_eq(decode_tag(b"\x01anything"), "ping")
}
