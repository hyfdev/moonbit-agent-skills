///|
pub(all) enum Source {
  File(String)
  Package(String)
} derive(Eq, Debug)

///|
pub fn classify(source : Source) -> String {
  match source {
    File(path) => "file:\{path}"
    Package(name) => "package:\{name}"
  }
}
