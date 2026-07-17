pub fn unique_count(values : ArrayView[Int]) -> Int {
  @hashset.HashSet::from_array(values).length()
}
