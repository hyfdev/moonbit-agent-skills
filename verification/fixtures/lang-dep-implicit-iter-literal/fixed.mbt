fn release_explicit_iter_literal() -> Iter[Int] {
  [| 0, ..[1, 2].iter(), 3 |]
}

test "explicit Iter literal" {
  debug_inspect(release_explicit_iter_literal().collect(), content="[0, 1, 2, 3]")
}
