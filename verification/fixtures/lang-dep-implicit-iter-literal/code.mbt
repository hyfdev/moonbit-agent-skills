fn release_old_iter_literal() -> Iter[Int] {
  [0, ..[1, 2].iter(), 3]
}

test "implicit Iter literal" {
  debug_inspect(release_old_iter_literal().collect(), content="[0, 1, 2, 3]")
}
