fn release_last_array_with_negative_index(xs : Array[Int]) -> ArrayView[Int] {
  xs[-1:]
}

fn release_last_string_with_negative_index(text : String) -> StringView {
  text[-1:]
}

fn release_last_bytes_with_negative_index(bytes : Bytes) -> BytesView {
  bytes[-1:]
}

test "negative ArrayView index aborts on MoonBit 0.10.4" {
  let view = release_last_array_with_negative_index([1, 2, 3])
  inspect(view.length(), content="0")
}

test "negative StringView index aborts on MoonBit 0.10.4" {
  let view = release_last_string_with_negative_index("abc")
  inspect(view.length(), content="0")
}

test "negative BytesView index aborts on MoonBit 0.10.4" {
  let view = release_last_bytes_with_negative_index(b"abc")
  inspect(view.length(), content="0")
}
