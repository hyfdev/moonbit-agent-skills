///|
test "library Codec implementation remains usable" {
  assert_eq(encode_json(), "json")
}

///|
test "library sealed trait implementation remains usable" {
  assert_eq(builtin_json_name(), "json")
}
