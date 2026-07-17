fn release_empty_map() -> Map[String, Int] {
  Map([])
}

fn release_empty_json() -> Json {
  Json::empty_object()
}

priv struct ReleaseEmptyRecord {}

fn release_empty_record() -> ReleaseEmptyRecord {
  ReleaseEmptyRecord::{}
}

fn release_removed_empty_block() -> Unit {
  ()
}

test "explicit empty map, JSON object, record, and Unit" {
  assert_eq(release_empty_map().length(), 0)
  json_inspect(release_empty_json(), content=Json::empty_object())
  ignore(release_empty_record())
  release_removed_empty_block()
}
