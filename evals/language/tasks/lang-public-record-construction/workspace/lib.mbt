///|
pub struct Request {
  verb : String
  path : String
}

///|
pub fn default_request() -> Request {
  { verb: "GET", path: "/" }
}

///|
pub fn describe_request(request : Request) -> String {
  "\{request.verb} \{request.path}"
}
