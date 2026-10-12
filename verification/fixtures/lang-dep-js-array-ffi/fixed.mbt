extern "js" fn first(values : FixedArray[Int]) -> Int = "values => values[0]"
test { let values : FixedArray[Int] = [7, 8]; assert_eq(first(values), 7) }
