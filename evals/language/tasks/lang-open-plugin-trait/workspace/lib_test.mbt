///|
test "library Codec implementation remains usable" {
  assert_eq(@open_plugin_trait.encode_json(), "json")
}

///|
test "library sealed trait implementation remains usable" {
  assert_eq(@open_plugin_trait.builtin_json_name(), "json")
}
