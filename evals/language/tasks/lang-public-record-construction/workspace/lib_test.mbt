///|
test "reads the public Request fields" {
  let request = default_request()
  assert_eq(request.verb, "GET")
  assert_eq(request.path, "/")
}

///|
test "keeps the default request" {
  assert_eq(describe_request(default_request()), "GET /")
}
