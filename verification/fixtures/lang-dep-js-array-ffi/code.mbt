extern "js" fn first(values : Array[Int]) -> Int = "values => values[0]"
test { assert_eq(first([7, 8]), 7) }
