///|
pub fn sum_positive(xs: Vec<i32>) -> i32 {
    let mut total = 0;
    for x in xs {
        match x {
            n if n > 0 => total += n,
            _ => (),
        }
    }
    return total;
}
