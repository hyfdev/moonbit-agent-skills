fn release_empty_map() -> Map[String, Int] {
  {}
}

priv struct ReleaseEmptyRecord {}

fn release_empty_record() -> ReleaseEmptyRecord {
  {}
}

fn release_empty_block() -> Unit {
  {}
}

test "ambiguous empty braces" {
  assert_eq(release_empty_map().length(), 0)
  ignore(release_empty_record())
  release_empty_block()
}
