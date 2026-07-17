fn release_renamed_identifier() -> Int {
  let result = 42
  result
}

test "identifier renamed before keyword reservation" {
  assert_eq(release_renamed_identifier(), 42)
}
