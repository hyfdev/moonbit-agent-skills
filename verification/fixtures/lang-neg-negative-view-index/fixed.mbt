fn release_last_array_with_explicit_index(xs : Array[Int]) -> ArrayView[Int] {
  xs[xs.length() - 1:]
}

fn release_last_string_with_explicit_index(text : String) -> StringView {
  text[text.length() - 1:]
}

fn release_last_bytes_with_explicit_index(bytes : Bytes) -> BytesView {
  bytes[bytes.length() - 1:]
}

test "views use explicit nonnegative indices" {
  debug_inspect(
    release_last_array_with_explicit_index([1, 2, 3]),
    content="<ArrayView: [3]>",
  )
  assert_eq(release_last_string_with_explicit_index("abc").to_owned(), "c")
  assert_eq(release_last_bytes_with_explicit_index(b"abc").to_owned(), b"c")
}
