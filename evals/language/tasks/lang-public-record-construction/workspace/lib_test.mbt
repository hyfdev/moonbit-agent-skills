///|
test "reads the public Request fields" {
  let request = @public_record_construction.default_request()
  assert_eq(request.verb, "GET")
  assert_eq(request.path, "/")
}

///|
test "keeps the default request" {
  assert_eq(
    @public_record_construction.describe_request(@public_record_construction.default_request()),
    "GET /",
  )
}
