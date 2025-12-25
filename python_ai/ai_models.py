import torch
import torch.nn as nn
from torchvision import models, transforms
from sentence_transformers import SentenceTransformer
from PIL import Image
import io
from pathlib import Path

class MoleculePredictor:
    def __init__(self):
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        # Load pre-trained ResNet-18
        self.model = models.resnet18(pretrained=True)
        # Modify the last layer for molecule classification (example: 10 classes)
        # In a real scenario, this would be trained on molecule images
        num_ftrs = self.model.fc.in_features
        self.model.fc = nn.Linear(num_ftrs, 10) 
        self.model = self.model.to(self.device)
        self.model.eval()
        
        self.transform = transforms.Compose([
            transforms.Resize(256),
            transforms.CenterCrop(224),
            transforms.ToTensor(),
            transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])
        ])
        
        # Mock classes for molecule prediction
        self.classes = ["Alcane", "Alkene", "Alkyne", "Alcohol", "Ether", "Aldehyde", "Ketone", "Carboxylic Acid", "Ester", "Amine"]

    def predict(self, image_bytes):
        image = Image.open(io.BytesIO(image_bytes)).convert('RGB')
        image = self.transform(image).unsqueeze(0).to(self.device)
        
        with torch.no_grad():
            outputs = self.model(image)
            _, predicted = torch.max(outputs, 1)
            
        return self.classes[predicted.item()]

class CoffeeEmbeddingModel:
    def __init__(self):
        # Use fine-tuned model if available, otherwise default to MiniLM
        model_path = Path(__file__).parent / "models" / "fine_tuned_minilm"
        if model_path.exists():
            self.model = SentenceTransformer(str(model_path))
        else:
            self.model = SentenceTransformer('all-MiniLM-L6-v2')
        
    def encode(self, text):
        return self.model.encode(text).tolist()
