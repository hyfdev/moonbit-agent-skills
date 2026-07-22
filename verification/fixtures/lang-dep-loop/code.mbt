fn sum_view(vs : ArrayView[Int]) -> Int {
  loop (0, vs) {
    (acc, [x, .. rest]) => continue (acc + x, rest)
    (acc, []) => break acc
  }
}
