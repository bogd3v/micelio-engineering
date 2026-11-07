//! A minimal library for the `rust` profile of the reusable `check.yml`.

/// Adds two numbers.
#[must_use]
pub fn add(a: u32, b: u32) -> u32 {
    a + b
}

#[cfg(test)]
mod tests {
    use super::add;

    #[test]
    fn adds_two_numbers() {
        assert_eq!(add(2, 3), 5);
    }
}
