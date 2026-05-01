package main

import (
	"crypto/ed25519"
	"crypto/x509"
	"encoding/pem"
	"fmt"
	"os"
)

func main() {
	pemData, err := os.ReadFile("secrets/service_assertion_public_key.pem")
	if err != nil {
		fmt.Println("ReadFile error:", err)
		return
	}
	block, _ := pem.Decode(pemData)
	parsed, err := x509.ParsePKIXPublicKey(block.Bytes)
	if err != nil {
		fmt.Println("ParsePKIXPublicKey error:", err)
		return
	}
	_, ok := parsed.(ed25519.PublicKey)
	if ok {
		fmt.Println("It is ed25519.PublicKey")
	} else {
		fmt.Printf("It is %T\n", parsed)
	}
}
