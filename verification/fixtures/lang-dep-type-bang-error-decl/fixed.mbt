pub suberror MyError { MyError(String) }
pub fn fail_as_my_error() -> Unit raise MyError { raise MyError("failed") }
