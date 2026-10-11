import { useState, useEffect } from 'react'

function App() {
  const [materials, setMaterials] = useState([])
  const [formData, setFormData] = useState({
    product_name: '',
    cable_type: '',
    selected_materials: [],
    compliance_notes: ''
  })
  const [message, setMessage] = useState('')

  useEffect(() => {
    fetch('/api/materials')
      .then((res) => res.json())
      .then((data) => {
        setMaterials(data.materials || [])
      })
      .catch((err) => console.error("Błąd pobierania materiałów:", err))
  }, [])

  const handleInputChange = (e) => {
    const { name, value } = e.target
    setFormData((prev) => ({ ...prev, [name]: value }))
  }

  // ZMIANA: Zapisujemy tylko nazwę materiału (string), a nie cały obiekt
  const handleMaterialToggle = (materialName) => {
    setFormData((prev) => {
      const isSelected = prev.selected_materials.includes(materialName)
      const newMaterials = isSelected
        ? prev.selected_materials.filter((m) => m !== materialName)
        : [...prev.selected_materials, materialName]
      
      return { ...prev, selected_materials: newMaterials }
    })
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    setMessage('')
    
    try {
      const res = await fetch('/api/survey', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(formData)
      })
      
      const data = await res.json()
      
      if (data.status === 'success') {
        setMessage(data.message)
        setFormData({
          product_name: '',
          cable_type: '',
          selected_materials: [],
          compliance_notes: ''
        })
      } else {
        setMessage("Błąd: Nie udało się zapisać.")
      }
    } catch (err) {
      console.error("Błąd sieci:", err)
      setMessage("Błąd połączenia z serwerem.")
    }
  }

  return (
    <div style={{ maxWidth: '600px', margin: '0 auto', padding: '20px', fontFamily: 'sans-serif' }}>
      <h1>BOMcheck Ankieta</h1>
      
      {message && (
        <div style={{ padding: '10px', background: '#d4edda', color: '#155724', marginBottom: '20px', borderRadius: '5px' }}>
          {message}
        </div>
      )}

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '5px' }}>Nazwa produktu:</label>
          <input 
            type="text" 
            name="product_name" 
            value={formData.product_name} 
            onChange={handleInputChange} 
            required 
            style={{ width: '100%', padding: '8px' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px' }}>Typ kabla:</label>
          <input 
            type="text" 
            name="cable_type" 
            value={formData.cable_type} 
            onChange={handleInputChange} 
            required 
            style={{ width: '100%', padding: '8px' }}
          />
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px' }}>Wybierz materiały:</label>
          {materials.length === 0 ? (
            <p style={{ color: '#888' }}>Brak materiałów w bazie (lub błąd pobierania).</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              {/* ZMIANA: iterujemy po obiektach, kluczem jest mat.id (lub mat.name), renderujemy mat.name */}
              {materials.map((mat) => (
                <label key={mat.id || mat.name}>
                  <input 
                    type="checkbox" 
                    checked={formData.selected_materials.includes(mat.name)}
                    onChange={() => handleMaterialToggle(mat.name)}
                  /> {mat.name} {mat.needs_rohs_check ? " (Wymaga RoHS)" : ""}
                </label>
              ))}
            </div>
          )}
        </div>

        <div>
          <label style={{ display: 'block', marginBottom: '5px' }}>Notatki (Compliance):</label>
          <textarea 
            name="compliance_notes" 
            value={formData.compliance_notes} 
            onChange={handleInputChange} 
            rows="4" 
            style={{ width: '100%', padding: '8px' }}
          ></textarea>
        </div>

        <button type="submit" style={{ padding: '10px', background: '#007bff', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '16px' }}>
          Wyślij ankietę
        </button>
      </form>
    </div>
  )
}

export default App