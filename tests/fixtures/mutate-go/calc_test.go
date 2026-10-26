package calc

import "testing"

func TestAdd(t *testing.T) {
	if Add(2, 3) != 5 {
		t.Fatal("Add(2, 3) != 5")
	}
}

func TestSame(t *testing.T) {
	if !Same(4, 4) || Same(4, 5) {
		t.Fatal("Same is wrong")
	}
}
